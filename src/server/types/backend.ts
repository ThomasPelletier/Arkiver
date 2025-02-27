export type BackendType = 's3' | 'local';

export interface BaseBackendConfig {
  type: BackendType;
}

export interface S3BackendConfig extends BaseBackendConfig {
  type: 's3';
  bucket: string;
  region: string;
  accessKeyId: string;      // Required for S3 authentication
  secretAccessKey: string;  // Required for S3 authentication
  s3Prefix?: string;       // Optional path prefix for S3 objects (e.g. 'backups/')
  endpoint?: string;       // Optional endpoint for S3-compatible services
  forcePathStyle?: boolean;
  sslEnabled?: boolean;
}



export interface LocalBackendConfig extends BaseBackendConfig {
  type: 'local';
  path: string;
}

export type BackendConfig = 
  | S3BackendConfig 
  | LocalBackendConfig;

export interface TaskConfig {
  source: string;
  destination: string;
  schedule: string;
  retention: number;
}

export interface AppConfig {
  backends: Record<string, BackendConfig>;
  tasks: Record<string, TaskConfig>;
}
