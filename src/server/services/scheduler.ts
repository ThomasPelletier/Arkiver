import cron from 'node-cron';
import { ConfigLoader } from '../config/config-loader';
import { TaskConfig } from '../types/backend';
import { Logger } from 'winston';
import { createLogger, format, transports } from 'winston';
import { BackendService } from './backend-service';
import { TaskStatusService } from './task-status';

export class Scheduler {
  private static instance: Scheduler;
  private tasks: Map<string, cron.ScheduledTask> = new Map();
  private logger: Logger;

  private constructor() {
    this.logger = createLogger({
      format: format.combine(
        format.timestamp(),
        format.json()
      ),
      transports: [
        new transports.Console(),
        new transports.File({ filename: 'scheduler.log' })
      ]
    });
  }

  public static getInstance(): Scheduler {
    if (!Scheduler.instance) {
      Scheduler.instance = new Scheduler();
    }
    return Scheduler.instance;
  }

  public initializeScheduler(): void {
    const config = ConfigLoader.getInstance().getConfig();
    
    // Clear existing tasks
    this.stopAllTasks();
    
    // Schedule new tasks
    Object.entries(config.tasks).forEach(([taskName, taskConfig]) => {
      this.scheduleTask(taskName, taskConfig);
    });
  }

  private scheduleTask(taskName: string, taskConfig: TaskConfig): void {
    if (!cron.validate(taskConfig.schedule)) {
      this.logger.error(`Invalid cron expression for task ${taskName}: ${taskConfig.schedule}`);
      return;
    }

    const task = cron.schedule(taskConfig.schedule, () => {
      this.executeTask(taskName, taskConfig);
    });

    this.tasks.set(taskName, task);
    this.logger.info(`Scheduled task ${taskName} with cron expression ${taskConfig.schedule}`);
  }

  private async executeTask(taskName: string, taskConfig: TaskConfig): Promise<void> {
    const taskStatusService = TaskStatusService.getInstance();
    taskStatusService.startTask(taskName);

    try {
      this.logger.info(`Executing task ${taskName}`, { taskConfig });
      
      // Add a small artificial delay to make status changes more visible
      await new Promise(resolve => setTimeout(resolve, 2000));
      
      await this.performArchiveTransfer(taskName, taskConfig);
      this.logger.info(`Successfully completed task ${taskName}`);
      
      // Add a small delay before completing to make status changes more visible
      await new Promise(resolve => setTimeout(resolve, 1000));
      
      taskStatusService.completeTask(taskName);
    } catch (error) {
      this.logger.error(`Failed to execute task ${taskName}`, { error });
      taskStatusService.failTask(taskName);
      throw error;
    }
  }

  private async performArchiveTransfer(taskName: string, taskConfig: TaskConfig): Promise<void> {
    const config = ConfigLoader.getInstance().getConfig();
    const sourceBackend = config.backends[taskConfig.source];
    const destBackend = config.backends[taskConfig.destination];

    if (!sourceBackend) {
      throw new Error(`Source backend ${taskConfig.source} not found`);
    }
    if (!destBackend) {
      throw new Error(`Destination backend ${taskConfig.destination} not found`);
    }

    const backendService = BackendService.getInstance();
    await backendService.transferFiles(taskName, sourceBackend, destBackend, taskConfig);
  }

  public stopAllTasks(): void {
    this.tasks.forEach(task => task.stop());
    this.tasks.clear();
  }

  public executeTaskManually(taskName: string): void {
    const config = ConfigLoader.getInstance().getConfig();
    const taskConfig = config.tasks[taskName];
    
    if (!taskConfig) {
      throw new Error(`Task ${taskName} not found`);
    }

    // Execute task asynchronously
    this.executeTask(taskName, taskConfig).catch(error => {
      this.logger.error(`Manual task execution failed for ${taskName}`, { error });
    });
  }
}
