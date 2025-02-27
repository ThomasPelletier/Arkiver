import { EventEmitter } from 'events';

export interface TaskStatus {
  taskName: string;
  status: 'running' | 'waiting' | 'not running';
}

export class TaskStatusService {
  private static instance: TaskStatusService;
  private statusMap: Map<string, TaskStatus>;
  private taskQueue: string[] = [];
  private eventEmitter: EventEmitter;

  private constructor() {
    this.statusMap = new Map();
    this.eventEmitter = new EventEmitter();
  }

  public static getInstance(): TaskStatusService {
    if (!TaskStatusService.instance) {
      TaskStatusService.instance = new TaskStatusService();
    }
    return TaskStatusService.instance;
  }

  public startTask(taskName: string): void {
    // Get current status of this task
    const currentStatus = this.statusMap.get(taskName);
    
    // If this task is already running, do nothing
    if (currentStatus?.status === 'running') {
      return;
    }

    // Check if any task is running
    const runningTask = Array.from(this.statusMap.values()).find(status => status.status === 'running');
    
    if (runningTask) {
      // If another task is running, queue this one
      if (!this.taskQueue.includes(taskName)) {
        this.taskQueue.push(taskName);
        this.statusMap.set(taskName, { taskName, status: 'waiting' });
        this.emitUpdate();
      }
    } else {
      // If no task is running, start this one
      this.statusMap.set(taskName, { taskName, status: 'running' });
      this.emitUpdate();
    }
  }

  public completeTask(taskName: string): void {
    this.statusMap.set(taskName, { taskName, status: 'not running' });
    
    // Start the next task in queue if any
    if (this.taskQueue.length > 0) {
      const nextTaskName = this.taskQueue.shift()!;
      this.statusMap.set(nextTaskName, { taskName: nextTaskName, status: 'running' });
    }
    
    this.emitUpdate();
  }

  public failTask(taskName: string): void {
    // Treat failure same as completion for simplicity
    this.completeTask(taskName);
  }

  private emitUpdate(): void {
    // Ensure updates are sent to all clients immediately
    setImmediate(() => {
      const statuses = Array.from(this.statusMap.entries()).map(([_, status]) => status);
      this.eventEmitter.emit('taskUpdate', statuses);
    });
  }

  public getTaskStatus(taskName: string): TaskStatus | undefined {
    return this.statusMap.get(taskName) || { taskName, status: 'not running' };
  }

  public getAllTaskStatuses(): TaskStatus[] {
    return Array.from(this.statusMap.values());
  }

  public clearOldStatuses(): void {
    // No need to clear statuses anymore as we only track current state
    return;
  }
}
