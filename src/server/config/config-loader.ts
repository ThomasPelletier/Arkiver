import { readFileSync } from 'fs';
import { parse } from 'yaml';
import { AppConfig, BackendConfig, TaskConfig } from '../types/backend';

export class ConfigLoader {
  private static instance: ConfigLoader;
  private config!: AppConfig;

  private constructor() {
    this.loadConfig();
  }

  public static getInstance(): ConfigLoader {
    if (!ConfigLoader.instance) {
      ConfigLoader.instance = new ConfigLoader();
    }
    return ConfigLoader.instance;
  }

  private loadConfig(): void {
    try {
      const configPath = process.env.CONFIG_PATH || 'config.yaml';
      const configFile = readFileSync(configPath, 'utf8');
      const rawConfig = parse(configFile) as AppConfig;
      
      // Filter out unsupported backends
      const supportedBackends: Record<string, BackendConfig> = {};
      Object.entries(rawConfig.backends || {}).forEach(([name, backend]: [string, { type: string } & Record<string, any>]) => {
        if (backend.type === 's3' || backend.type === 'local') {
          supportedBackends[name] = backend as BackendConfig;
        } else {
          console.warn(`Skipping unsupported backend type: ${backend.type} for ${name}`);
        }
      });

      // Update tasks to only use supported backends
      const validTasks: Record<string, TaskConfig> = {};
      Object.entries(rawConfig.tasks || {}).forEach(([name, task]: [string, TaskConfig]) => {
        const sourceBackend = rawConfig.backends[task.source];
        const destBackend = rawConfig.backends[task.destination];

        if (!sourceBackend || !destBackend || typeof sourceBackend !== 'object' || typeof destBackend !== 'object') {
          console.warn(`Skipping task ${name}: missing backend configuration`);
          return;
        }

        if ('type' in sourceBackend && 'type' in destBackend &&
            (sourceBackend.type === 'local' || sourceBackend.type === 's3') &&
            (destBackend.type === 'local' || destBackend.type === 's3')) {
          validTasks[name] = task;
        } else {
          console.warn(`Skipping task ${name}: unsupported backend types`);
        }
      });

      this.config = {
        backends: supportedBackends,
        tasks: validTasks
      };

      this.validateConfig();
      console.log('Loaded configuration with supported backends:', Object.keys(supportedBackends));
      console.log('Valid tasks:', Object.keys(validTasks));
    } catch (error) {
      throw new Error(`Failed to load configuration: ${error}`);
    }
  }

  private validateConfig(): void {
    if (!this.config.backends || !this.config.tasks) {
      throw new Error('Invalid configuration: missing backends or tasks');
    }

    // Validate that all tasks reference valid backends
    for (const [taskName, task] of Object.entries(this.config.tasks)) {
      if (!this.config.backends[task.source]) {
        throw new Error(`Invalid configuration: task ${taskName} references non-existent source backend ${task.source}`);
      }
      if (!this.config.backends[task.destination]) {
        throw new Error(`Invalid configuration: task ${taskName} references non-existent destination backend ${task.destination}`);
      }
    }
  }

  public getConfig(): AppConfig {
    return this.config;
  }

  public reloadConfig(): void {
    this.loadConfig();
  }
}
