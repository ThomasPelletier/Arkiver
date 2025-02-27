export interface Task {
  source: string;
  destination: string;
  schedule: string;
  retention: number;
}

export type BackendType = 's3' | 'local';

export interface BaseBackend {
  type: BackendType;
}

export interface S3Backend extends BaseBackend {
  type: 's3';
  bucket: string;
  region: string;
  endpoint?: string;
  prefix?: string;
  forcePathStyle?: boolean;
  sslEnabled?: boolean;
}

export interface LocalBackend extends BaseBackend {
  type: 'local';
  path: string;
}

export type Backend = S3Backend | LocalBackend;

export interface TasksResponse {
  [key: string]: Task;
}

export interface BackendsResponse {
  [key: string]: Backend;
}

export interface Archive {
  name: string;
  path: string;
  size: number;
  createdAt: string;
}

export interface TaskStatus {
  taskName: string;
  status: 'running' | 'completed' | 'failed';
  startTime: string;
  endTime?: string;
  error?: string;
}
