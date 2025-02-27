export interface TaskConfig {
  source: string;
  destination: string;
  schedule: string;
  prefix?: string;  // Custom prefix for archive names
  retention?: number;
  encryption?: {
    enabled: boolean;
    key: string;
    algorithm?: 'aes-256-cbc'; // For future algorithm support
  };
}
