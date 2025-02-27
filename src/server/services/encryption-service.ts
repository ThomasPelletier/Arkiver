import crypto from 'crypto';
import { createReadStream, createWriteStream } from 'fs';
import { Transform, TransformCallback } from 'stream';
import { pipeline } from 'stream/promises';

export class EncryptionService {
  private static instance: EncryptionService;

  private constructor() {}

  public static getInstance(): EncryptionService {
    if (!EncryptionService.instance) {
      EncryptionService.instance = new EncryptionService();
    }
    return EncryptionService.instance;
  }

  public createEncryptStream(password: string): Transform {
    let headerWritten = false;
    const salt = crypto.randomBytes(8);
    
    // Generate key and IV using OpenSSL's EVP_BytesToKey
    const keyAndIv = this.generateKeyAndIv(password, salt);
    const cipher = crypto.createCipheriv('aes-256-cbc', keyAndIv.key, keyAndIv.iv);

    return new Transform({
      transform(chunk: Buffer, _encoding: string, callback: TransformCallback) {
        try {
          if (!headerWritten) {
            // Write OpenSSL compatible header
            this.push(Buffer.from('Salted__', 'ascii'));
            this.push(salt);
            headerWritten = true;
          }

          this.push(cipher.update(chunk));
          callback();
        } catch (error) {
          callback(error instanceof Error ? error : new Error(String(error)));
        }
      },
      flush(callback: TransformCallback) {
        try {
          this.push(cipher.final());
          callback();
        } catch (error) {
          callback(error instanceof Error ? error : new Error(String(error)));
        }
      }
    });
  }

  private generateKeyAndIv(password: string, salt: Buffer): { key: Buffer; iv: Buffer } {
    const keyLength = 32; // AES-256
    const ivLength = 16;  // AES block size
    const targetLength = keyLength + ivLength;
    
    let keyIvData = Buffer.alloc(0);
    let currentHash = Buffer.alloc(0);
    
    while (keyIvData.length < targetLength) {
      const md5 = crypto.createHash('md5');
      md5.update(currentHash);
      md5.update(Buffer.from(password));
      md5.update(salt);
      currentHash = md5.digest();
      keyIvData = Buffer.concat([keyIvData, currentHash]);
    }
    
    return {
      key: keyIvData.slice(0, keyLength),
      iv: keyIvData.slice(keyLength, targetLength)
    };
  }

  public createDecryptStream(password: string): Transform {
    let buffer = Buffer.alloc(0);
    let headerRead = false;
    let decipher: crypto.Decipher;

    return new Transform({
      transform(chunk: Buffer, _encoding: string, callback: TransformCallback) {
        try {
          buffer = Buffer.concat([buffer, chunk]);

          if (!headerRead && buffer.length >= 16) {
            // Read OpenSSL header
            const header = buffer.slice(0, 8).toString('ascii');
            if (header !== 'Salted__') {
              throw new Error('Invalid OpenSSL header');
            }

            const salt = buffer.slice(8, 16);
            buffer = buffer.slice(16);

            // Generate key and IV using OpenSSL's method
            const keyAndIv = (this as any).generateKeyAndIv(password, salt);
            decipher = crypto.createDecipheriv('aes-256-cbc', keyAndIv.key, keyAndIv.iv);
            headerRead = true;
          }

          if (headerRead && buffer.length > 0) {
            this.push(decipher.update(buffer));
            buffer = Buffer.alloc(0);
          }

          callback();
        } catch (error) {
          callback(error instanceof Error ? error : new Error(String(error)));
        }
      },
      flush(callback: TransformCallback) {
        if (!headerRead) {
          callback(new Error('No header found in encrypted data'));
          return;
        }
        try {
          this.push(decipher.final());
          callback();
        } catch (error) {
          callback(error instanceof Error ? error : new Error(String(error)));
        }
      }
    });
  }

  public async encryptFile(inputPath: string, outputPath: string, key: string): Promise<void> {
    const readStream = createReadStream(inputPath);
    const writeStream = createWriteStream(outputPath);
    const encryptStream = this.createEncryptStream(key);

    await pipeline(readStream, encryptStream, writeStream);
  }

  public async decryptFile(inputPath: string, outputPath: string, key: string): Promise<void> {
    const readStream = createReadStream(inputPath);
    const writeStream = createWriteStream(outputPath);
    const decryptStream = this.createDecryptStream(key);

    await pipeline(readStream, decryptStream, writeStream);
  }
}
