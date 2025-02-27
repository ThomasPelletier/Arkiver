import express from 'express';
import path from 'path';
import { ConfigLoader } from './config/config-loader';
import { Scheduler } from './services/scheduler';
import { BackendService } from './services/backend-service';
import { TaskStatusService } from './services/task-status';
import { TaskConfig } from './types/task';

const app = express();
const port = process.env.PORT || 3001;

app.use(express.json());

// Serve static files from the React app
app.use(express.static(path.join(__dirname, '../../client/build')));

// Simple CORS middleware
app.use((_req, res, next) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  next();
});


// Initialize scheduler
const scheduler = Scheduler.getInstance();
scheduler.initializeScheduler();

// API endpoints
app.get('/api/tasks', (_req, res) => {
  const config = ConfigLoader.getInstance().getConfig();
  res.json(config.tasks);
});

app.get('/api/backends', (_req, res) => {
  const config = ConfigLoader.getInstance().getConfig();
  res.json(config.backends);
});

app.get('/api/tasks/:taskName/archives', async (req, res): Promise<any> => {
  try {
    const { taskName } = req.params;
    console.log(`Fetching archives for task: ${taskName}`);
    
    const config = ConfigLoader.getInstance().getConfig();
    const task = config.tasks[taskName];

    if (!task) {
      console.error(`Task not found: ${taskName}`);
      return res.status(404).json({ error: `Task ${taskName} not found` });
    }
    console.log(`Found task: ${JSON.stringify(task)}`);

    const destBackend = config.backends[task.destination];
    if (!destBackend) {
      console.error(`Destination backend not found: ${task.destination}`);
      return res.status(404).json({ error: `Destination backend ${task.destination} not found` });
    }
    console.log(`Found backend: ${JSON.stringify(destBackend)}`);

    const backendService = BackendService.getInstance();
    // Pass the task's prefix to filter archives
    // Get prefix from task config
    const taskConfig = task as TaskConfig;
    const taskPrefix = taskConfig.prefix || '';
    const archives = await backendService.listArchives(destBackend, taskPrefix);
    console.log(`Found archives: ${JSON.stringify(archives)}`);
    res.json(archives);
  } catch (error) {
    console.error('Error in /api/tasks/:taskName/archives:', error);
    res.status(500).json({ error: `Failed to list archives: ${error}` });
  }
});

app.post('/api/tasks/:taskName/execute', (req, res) => {
  try {
    const { taskName } = req.params;
    scheduler.executeTaskManually(taskName);
    res.json({ message: `Task ${taskName} execution started` });
  } catch (error) {
    res.status(500).json({ error: `Failed to start task: ${error}` });
  }
});

app.get('/api/tasks/:taskName/status', (req, res) => {
  try {
    const { taskName } = req.params;
    const taskStatuses = TaskStatusService.getInstance().getTaskStatus(taskName);
    if (taskStatuses) {
      res.json(taskStatuses);
    } else {
      res.status(404).json({ error: `No status found for task ${taskName}` });
    }
  } catch (error) {
    res.status(500).json({ error: `Failed to get task status: ${error}` });
  }
});

app.get('/api/tasks/status', (_req, res) => {
  try {
    const taskStatus = TaskStatusService.getInstance().getAllTaskStatuses();
    res.json(taskStatus);
  } catch (error) {
    res.status(500).json({ error: `Failed to get task statuses: ${error}` });
  }
});

app.post('/api/config/reload', (_req, res) => {
  try {
    ConfigLoader.getInstance().reloadConfig();
    scheduler.initializeScheduler();
    res.json({ message: 'Configuration reloaded successfully' });
  } catch (error) {
    res.status(500).json({ error: `Failed to reload configuration: ${error}` });
  }
});

// The "catchall" handler: for any request that doesn't
// match one above, send back React's index.html file.
app.get('*', (_req, res) => {
  res.sendFile(path.join(__dirname, '../../client/build/index.html'));
});

app.listen(port, () => {
  console.log(`Server is running on port ${port}`);
});
