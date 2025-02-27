import fs from 'fs';
import path from 'path';
import { 
  S3Client, 
  DeleteObjectCommand, 
  ListObjectsV2Command, 
  ListObjectsV2CommandInput, 
  S3ClientConfig 
} from '@aws-sdk/client-s3';
import { Upload } from '@aws-sdk/lib-storage';
import { BackendConfig, LocalBackendConfig, S3BackendConfig } from '../types/backend';
import { TaskStatusService } from './task-status';
import archiver from 'archiver';
import { Logger } from 'winston';
import { getLogger } from '../utils/logger';
import { TaskConfig } from '../types/task';
import { EncryptionService } from './encryption-service';

export interface Archive {
  name: string;
  path: string;
  size: number;
  createdAt: Date;
}

export class BackendService {
  private static instance: BackendService;
  private logger: Logger;

  private constructor() {
    this.logger = getLogger();
  }

  public static getInstance(): BackendService {
    if (!BackendService.instance) {
      BackendService.instance = new BackendService();
    }
    return BackendService.instance;
  }

  private async transferLocalToS3(source: LocalBackendConfig, dest: S3BackendConfig, task: TaskConfig): Promise<void> {
    if (!fs.existsSync(source.path)) {
      throw new Error(`Source directory ${source.path} does not exist`);
    }

    const s3 = this.getS3Client(dest);
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const isEncrypted = task.encryption?.enabled && task.encryption.key;
    const prefix = task.prefix || 'archive';
    
    // Step 1: Create zip file
    const zipFileName = `${prefix}-${timestamp}.zip`;
    const zipFilePath = path.join(process.cwd(), 'temp', zipFileName);
    
    // Step 2: If encryption enabled, we'll create encrypted file
    const encryptedFileName = `${zipFileName}.crypt`;
    const encryptedFilePath = path.join(process.cwd(), 'temp', encryptedFileName);
    
    // Final file to upload will be either zip or encrypted
    const finalFilePath = isEncrypted ? encryptedFilePath : zipFilePath;
    
    // S3 key uses the final filename
    // Use s3Prefix from backend config as the path prefix
    const s3PathPrefix = dest.s3Prefix ? `${dest.s3Prefix}/` : '';
    const s3Key = `${s3PathPrefix}${isEncrypted ? encryptedFileName : zipFileName}`;

    // Ensure temp directory exists
    const tempDir = path.join(process.cwd(), 'temp');
    if (!fs.existsSync(tempDir)) {
      fs.mkdirSync(tempDir);
    }

    try {
      // Step 1: Create the ZIP archive
      this.logger.info('Creating ZIP archive...');
      const output = fs.createWriteStream(zipFilePath);

      // Create archive stream with optional encryption
      const archive = archiver('zip', {
        zlib: { level: 9 } // Maximum compression
      });

      // Setup archive events
      archive.on('warning', (err) => {
        if (err.code === 'ENOENT') {
          console.warn('Archive warning:', err);
        } else {
          throw err;
        }
      });

      archive.on('error', (err) => {
        throw err;
      });

      // Track progress
      let totalBytes = 0;
      let processedBytes = 0;

      // Get total size
      const files = await fs.promises.readdir(source.path);
      for (const file of files) {
        const sourcePath = path.join(source.path, file);
        const stats = await fs.promises.stat(sourcePath);
        if (stats.isFile()) {
          totalBytes += stats.size;
        }
      }

      archive.on('progress', (progress) => {
        processedBytes = progress.fs.processedBytes;
        const percent = (processedBytes / totalBytes * 100).toFixed(2);
        console.log(`Archiving progress: ${percent}% (${processedBytes}/${totalBytes} bytes)`);
      });

      // Pipe archive to file
      archive.pipe(output);

      // Add files to archive (without encryption)
      for (const file of files) {
        const sourcePath = path.join(source.path, file);
        const stats = await fs.promises.stat(sourcePath);
        if (stats.isFile()) {
          archive.file(sourcePath, { name: file });
          this.logger.info(`Added ${sourcePath} to archive`);
        }
      }

      // Finalize archive and wait for completion
      await archive.finalize();

      // Wait for write stream to finish
      await new Promise<void>((resolve, reject) => {
        output.on('finish', () => resolve());
        output.on('error', reject);
      });

      console.log('Archive created...');

      // Step 2: If encryption is enabled, encrypt the ZIP file
      if (task.encryption?.enabled && task.encryption?.key) {
        this.logger.info('Encrypting archive...');
        this.logger.info(`Source ZIP: ${zipFilePath}`);
        this.logger.info(`Target encrypted file: ${encryptedFilePath}`);
        
        const encryptionService = EncryptionService.getInstance();
        const readStream = fs.createReadStream(zipFilePath);
        const writeStream = fs.createWriteStream(encryptedFilePath);

        // We know encryption exists and has a key because of isEncrypted check
        if (!task.encryption || !task.encryption.key) {
          throw new Error('Encryption configuration is missing');
        }
        const encryptStream = encryptionService.createEncryptStream(task.encryption.key);
        
        await new Promise<void>((resolve, reject) => {
          readStream
            .pipe(encryptStream)
            .pipe(writeStream)
            .on('finish', () => {
              this.logger.info('Encryption complete');
              resolve();
            })
            .on('error', (err) => {
              this.logger.error('Encryption failed:', err);
              reject(err);
            });
        });
        
        // Verify encryption succeeded
        if (!fs.existsSync(encryptedFilePath)) {
          throw new Error('Encryption failed - encrypted file not found');
        }
        
        const encryptedSize = fs.statSync(encryptedFilePath).size;
        this.logger.info(`Original ZIP size: ${fs.statSync(zipFilePath).size} bytes`);
        this.logger.info(`Encrypted file size: ${encryptedSize} bytes`);
        
        // Clean up the ZIP file since we have the encrypted version
        fs.unlinkSync(zipFilePath);
      }
      
      this.logger.info(`Starting S3 upload of ${isEncrypted ? 'encrypted' : 'unencrypted'} archive...`);

      // Step 3: Upload the final file to S3
      const fileStream = fs.createReadStream(finalFilePath);
      const uploadParams = {
        Bucket: dest.bucket,
        Key: s3Key,
        Body: fileStream
      };

      const upload = new Upload({
        client: s3,
        params: uploadParams
      });

      // Track upload progress
      upload.on('httpUploadProgress', (progress) => {
        if (progress.loaded && progress.total) {
          const percent = (progress.loaded / progress.total * 100).toFixed(2);
          console.log(`Upload progress: ${percent}% (${progress.loaded}/${progress.total} bytes)`);
        }
      });

      await upload.done();
      console.log(`Uploaded ${finalFilePath} to s3://${dest.bucket}/${s3Key}`);

      // Cleanup old archives if retention > 0
      if (task.retention !== undefined && task.retention > 0) {
        const archives = await this.listS3Archives(dest, task.prefix);
        if (archives.length > task.retention) {
          const archivesToDelete = archives.slice(task.retention);
          for (const archive of archivesToDelete) {
            await s3.send(new DeleteObjectCommand({
              Bucket: dest.bucket,
              Key: archive.path
            }));
            console.log(`Deleted old archive: ${archive.path}`);
          }
        }
      } else {
        console.log('No retention policy set, keeping all archives');
      }

    } finally {
      // Clean up any remaining files
      if (fs.existsSync(zipFilePath)) {
        await fs.promises.unlink(zipFilePath);
        this.logger.info('Cleaned up ZIP file');
      }
      if (fs.existsSync(encryptedFilePath)) {
        await fs.promises.unlink(encryptedFilePath);
        this.logger.info('Cleaned up encrypted file');
      }
    }

  }

  public async transferFiles(taskName: string, sourceConfig: BackendConfig, destConfig: BackendConfig, task: TaskConfig): Promise<void> {
    const taskStatus = TaskStatusService.getInstance();
    taskStatus.startTask(taskName);

    try {
    if (sourceConfig.type === 'local' && destConfig.type === 'local') {
      await this.transferLocalToLocal(
        sourceConfig as LocalBackendConfig,
        destConfig as LocalBackendConfig,
        task
      );
    } else if (sourceConfig.type === 'local' && destConfig.type === 's3') {
      await this.transferLocalToS3(
        sourceConfig as LocalBackendConfig,
        destConfig as S3BackendConfig,
        task
      );
    } else {
      throw new Error(`Transfer from ${sourceConfig.type} to ${destConfig.type} not implemented yet`);
    }

    taskStatus.completeTask(taskName);
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      this.logger.error(`Task ${taskName} failed: ${errorMessage}`);
      taskStatus.failTask(taskName);
      throw error;
    }
  }

  private getS3Client(config: S3BackendConfig): S3Client {
    if (!config.accessKeyId || !config.secretAccessKey) {
      throw new Error('S3 configuration requires both accessKeyId and secretAccessKey');
    }

    const s3Config: S3ClientConfig = {
      region: config.region,
      credentials: {
        accessKeyId: config.accessKeyId,
        secretAccessKey: config.secretAccessKey
      }
    };

    if (config.endpoint) {
      // Only add endpoint-related config if endpoint is defined
      const endpointConfig: Partial<S3ClientConfig> = {
        endpoint: config.endpoint,
        forcePathStyle: config.forcePathStyle ?? true
      };
      Object.assign(s3Config, endpointConfig);
    }

    return new S3Client(s3Config);
  }

  private async listS3Archives(backend: S3BackendConfig, taskPrefix?: string): Promise<Archive[]> {
    console.log(`Listing S3 archives in bucket: ${backend.bucket}`);
    const s3 = this.getS3Client(backend);

    // Use s3Prefix from backend config as the path prefix
    const s3PathPrefix = backend.s3Prefix ? `${backend.s3Prefix}/` : '';
    const params: ListObjectsV2CommandInput = {
      Bucket: backend.bucket,
      Prefix: s3PathPrefix
    };

    try {
      const response = await s3.send(new ListObjectsV2Command(params));
      const archives: Archive[] = [];

      for (const object of response.Contents || []) {
        // Skip if no Key
        if (!object.Key) continue;

        // Remove s3Prefix path to get just the filename
        const fileName = object.Key.slice(s3PathPrefix.length);
        
        // Check if it's an archive file and matches the task prefix
        const isArchiveFile = fileName.endsWith('.zip') || fileName.endsWith('.zip.crypt');
        const matchesPrefix = !taskPrefix || fileName.startsWith(`${taskPrefix}-`);
        
        if (isArchiveFile && matchesPrefix) {
          archives.push({
            name: path.basename(object.Key),
            path: object.Key,
            size: object.Size || 0,
            createdAt: object.LastModified || new Date()
          });
        }
      }

      return archives.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
    } catch (error) {
      console.error('Error listing S3 archives:', error);
      throw error;
    }
  }

  public async listArchives(backend: { type: string } & Record<string, any>, taskPrefix?: string): Promise<Archive[]> {
    try {
      console.log(`Listing archives for backend type: ${backend.type}`);
      
      switch (backend.type) {
        case 'local':
          const archives = await this.listLocalArchives(backend as LocalBackendConfig, taskPrefix);
          console.log(`Found ${archives.length} archives`);
          return archives;
        case 's3':
          const s3Archives = await this.listS3Archives(backend as S3BackendConfig, taskPrefix);
          console.log(`Found ${s3Archives.length} archives`);
          return s3Archives;
        default:
          throw new Error(`Listing archives for backend type ${backend.type} not implemented yet`);
      }
    } catch (error) {
      console.error('Error in listArchives:', error);
      throw error;
    }
  }

  private async listLocalArchives(backend: LocalBackendConfig, taskPrefix?: string): Promise<Archive[]> {
    console.log(`Checking local archives in path: ${backend.path}`);
    
    if (!fs.existsSync(backend.path)) {
      console.log(`Path does not exist: ${backend.path}`);
      return [];
    }

    const files = await fs.promises.readdir(backend.path);
    const archives: Archive[] = [];

    for (const file of files) {
      // Check if file matches task prefix and is a zip/encrypted file
      const isArchiveFile = file.endsWith('.zip') || file.endsWith('.zip.crypt');
      const matchesPrefix = !taskPrefix || file.startsWith(`${taskPrefix}-`);
      
      // Only include files that match both the archive pattern and the task prefix
      if (isArchiveFile && matchesPrefix) {
        const filePath = path.join(backend.path, file);
        const stats = await fs.promises.stat(filePath);

        archives.push({
          name: file,
          path: filePath,
          size: stats.size,
          createdAt: stats.mtime
        });
      }
    }

    return archives.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
  }

  private async cleanupOldArchives(destPath: string, retention: number, taskPrefix?: string): Promise<void> {
    // If retention is 0, keep all archives
    if (retention === 0) {
      console.log('Retention is 0, keeping all archives');
      return;
    }

    // Get all zip files in the destination directory that match our pattern
    const files = await fs.promises.readdir(destPath);
    const zipFiles = files
      .filter(file => {
        // Only include files that match both the archive pattern and the task prefix
        const isArchiveFile = file.endsWith('.zip') || file.endsWith('.zip.crypt');
        const matchesPrefix = !taskPrefix || file.startsWith(`${taskPrefix}-`);
        return isArchiveFile && matchesPrefix;
      })
      .map(file => ({
        name: file,
        path: path.join(destPath, file),
        time: fs.statSync(path.join(destPath, file)).mtime.getTime()
      }))
      .sort((a, b) => b.time - a.time); // Sort by newest first

    // Remove old archives exceeding retention limit
    if (zipFiles.length > retention) {
      const filesToDelete = zipFiles.slice(retention);
      for (const file of filesToDelete) {
        await fs.promises.unlink(file.path);
        console.log(`Deleted old archive: ${file.name}`);
      }
    }
  }

  private async transferLocalToLocal(source: LocalBackendConfig, dest: LocalBackendConfig, task: TaskConfig): Promise<void> {
    // Ensure source directory exists
    if (!fs.existsSync(source.path)) {
      throw new Error(`Source directory ${source.path} does not exist`);
    }

    // Create destination directory if it doesn't exist
    if (!fs.existsSync(dest.path)) {
      fs.mkdirSync(dest.path, { recursive: true });
    }

    // Generate timestamp for the zip file name
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const isEncrypted = task.encryption?.enabled && task.encryption.key;
    const prefix = task.prefix || 'archive';
    
    // Step 1: Create zip file
    const zipFileName = `${prefix}-${timestamp}.zip`;
    const zipPath = path.join(dest.path, zipFileName);
    
    // Step 2: If encryption enabled, we'll create encrypted file
    const encryptedFileName = `${zipFileName}.crypt`;
    const encryptedPath = path.join(dest.path, encryptedFileName);
    
    // Create write stream for zip
    const output = fs.createWriteStream(zipPath);

    // Create archive stream
    const archive = archiver('zip', {
      zlib: { level: 9 } // Maximum compression
    });

    // Pipe archive data to file
    archive.pipe(output);

    // Handle archive warnings
    archive.on('warning', (err) => {
      if (err.code === 'ENOENT') {
        console.warn('Archive warning:', err);
      } else {
        throw err;
      }
    });

    archive.on('error', (err) => {
      throw err;
    });

    // Read all files from source
    const files = await fs.promises.readdir(source.path);
    
    // Add each file to the archive stream
    for (const file of files) {
      const sourcePath = path.join(source.path, file);
      const stats = await fs.promises.stat(sourcePath);

      if (stats.isFile()) {
        archive.file(sourcePath, { name: file });
        console.log(`Added ${sourcePath} to archive`);
      }
    }

    // Finalize the archive and wait for it to complete
    await archive.finalize();

    // Wait for the output stream to finish
    await new Promise<void>((resolve, reject) => {
      output.on('finish', () => resolve());
      output.on('error', reject);
    });

    console.log(`Created archive at ${zipPath}`);

    // Step 2: If encryption is enabled, encrypt the ZIP file
    if (isEncrypted) {
      this.logger.info('Encrypting archive...');
      this.logger.info(`Source ZIP: ${zipPath}`);
      this.logger.info(`Target encrypted file: ${encryptedPath}`);
      
      const encryptionService = EncryptionService.getInstance();
      const readStream = fs.createReadStream(zipPath);
      const writeStream = fs.createWriteStream(encryptedPath);

      // We know encryption exists and has a key because of isEncrypted check
      if (!task.encryption || !task.encryption.key) {
        throw new Error('Encryption configuration is missing');
      }
      const encryptStream = encryptionService.createEncryptStream(task.encryption.key);
      
      await new Promise<void>((resolve, reject) => {
        readStream
          .pipe(encryptStream)
          .pipe(writeStream)
          .on('finish', () => {
            this.logger.info('Encryption complete');
            resolve();
          })
          .on('error', (err) => {
            this.logger.error('Encryption failed:', err);
            reject(err);
          });
      });
      
      // Verify encryption succeeded
      if (!fs.existsSync(encryptedPath)) {
        throw new Error('Encryption failed - encrypted file not found');
      }
      
      const encryptedSize = fs.statSync(encryptedPath).size;
      this.logger.info(`Original ZIP size: ${fs.statSync(zipPath).size} bytes`);
      this.logger.info(`Encrypted file size: ${encryptedSize} bytes`);
      
      // Clean up the ZIP file since we have the encrypted version
      fs.unlinkSync(zipPath);
    }

    // Clean up old archives based on retention policy
    if (task.retention !== undefined) {
      await this.cleanupOldArchives(dest.path, task.retention, task.prefix);
    } else {
      this.logger.info('No retention policy set, keeping all archives');
    }
  }
}
