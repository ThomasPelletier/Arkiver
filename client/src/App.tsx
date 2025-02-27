import React, { useEffect, useState } from 'react';
import { BrowserRouter, Routes, Route, useNavigate, useParams } from 'react-router-dom';
import './App.css';

type Task = {
  source: string;
  destination: string;
  schedule: string;
  retention: number;
  encryption?: {
    enabled: boolean;
    key: string;
    algorithm?: string;
  };
};

type Backend = {
  type: string;
  [key: string]: any;
};

type TaskStatus = {
  taskName: string;
  status: 'running' | 'waiting' | 'not running';
};

type Archive = {
  name: string;
  size: number;
  createdAt: string;
};

function TaskDetails() {
  const { taskName } = useParams();
  const navigate = useNavigate();
  const [archives, setArchives] = useState<Archive[]>([]);

  useEffect(() => {
    if (taskName) {
      fetchArchives(taskName);
    }
  }, [taskName]);

  const fetchArchives = async (taskName: string) => {
    try {
      const response = await fetch(`http://localhost:3001/api/tasks/${taskName}/archives`);
      if (response.ok) {
        const data = await response.json();
        setArchives(data);
      }
    } catch (error) {
      console.error('Error fetching archives:', error);
    }
  };

  const formatSize = (bytes: number) => {
    const units = ['B', 'KB', 'MB', 'GB'];
    let size = bytes;
    let unit = 0;
    while (size >= 1024 && unit < units.length - 1) {
      size /= 1024;
      unit++;
    }
    return `${size.toFixed(1)} ${units[unit]}`;
  };

  return (
    <div className="container">
      <div className="header">
        <button onClick={() => navigate('/')}>&larr; Back</button>
        <h1>{taskName}</h1>
      </div>
      <div className="archives">
        <h2>Archives</h2>
        {archives.length === 0 ? (
          <p>No archives found</p>
        ) : (
          <div className="table-container">
            <table>
            <thead>
              <tr>
                <th>Name</th>
                <th>Size</th>
                <th>Created</th>
              </tr>
            </thead>
            <tbody>
              {archives.map(archive => (
                <tr key={archive.name}>
                  <td>{archive.name}</td>
                  <td>{formatSize(archive.size)}</td>
                  <td>{new Date(archive.createdAt).toLocaleString()}</td>
                </tr>
              ))}
            </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}

function Dashboard() {
  const navigate = useNavigate();
  const [tasks, setTasks] = useState<Record<string, Task>>({});
  const [backends, setBackends] = useState<Record<string, Backend>>({});
  const [taskStatuses, setTaskStatuses] = useState<Record<string, TaskStatus>>({});

  useEffect(() => {
    fetchData();
    
    // Set up polling for task status
    const pollStatus = async () => {
      try {
        const response = await fetch('http://localhost:3001/api/tasks/status');
        const statuses = await response.json();
        const statusMap = statuses.reduce((acc: Record<string, TaskStatus>, status: TaskStatus) => {
          acc[status.taskName] = status;
          return acc;
        }, {});
        setTaskStatuses(statusMap);
      } catch (error) {
        console.error('Error polling task status:', error);
      }
    };

    // Initial poll
    pollStatus();

    // Set up interval
    const pollInterval = setInterval(pollStatus, 1000);

    return () => {
      clearInterval(pollInterval);
    };
  }, []);

  const fetchData = async () => {
    try {
      const [tasksRes, backendsRes] = await Promise.all([
        fetch('http://localhost:3001/api/tasks'),
        fetch('http://localhost:3001/api/backends')
      ]);
      
      if (tasksRes.ok && backendsRes.ok) {
        const [tasksData, backendsData] = await Promise.all([
          tasksRes.json(),
          backendsRes.json()
        ]);
        setTasks(tasksData);
        setBackends(backendsData);
      }
    } catch (error) {
      console.error('Error fetching data:', error);
    }
  };

  const fetchTaskStatuses = async () => {
    try {
      const response = await fetch('http://localhost:3001/api/tasks/status');
      if (response.ok) {
        const statuses = await response.json();
        const statusMap = statuses.reduce((acc: Record<string, TaskStatus>, status: TaskStatus) => {
          acc[status.taskName] = status;
          return acc;
        }, {});
        setTaskStatuses(statusMap);
      }
    } catch (error) {
      console.error('Error fetching task statuses:', error);
    }
  };

  const executeTask = async (taskName: string) => {
    try {
      await fetch(`http://localhost:3001/api/tasks/${taskName}/execute`, {
        method: 'POST'
      });
    } catch (error) {
      console.error('Error executing task:', error);
    }
  };

  return (
    <div className="container">
      <div className="header">
        <h1>Arkiver</h1>
      </div>

      <div className="content">
        <section className="tasks">
          <h2>Tasks</h2>
          <div className="table-container">
            <table>
            <thead>
              <tr>
                <th>Name</th>
                <th>Source</th>
                <th>Destination</th>
                <th>Schedule</th>
                <th>Retention</th>
                <th>Encryption</th>
                <th>Status</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {Object.entries(tasks).map(([name, task]) => (
                <tr key={name}>
                  <td>{name}</td>
                  <td>{task.source}</td>
                  <td>{task.destination}</td>
                  <td>{task.schedule}</td>
                  <td>{task.retention ? `Keep ${task.retention} archives` : 'Keep all'}</td>
                  <td>{task.encryption?.enabled ? '🔒 Encrypted' : '🔓 Not encrypted'}</td>
                  <td>
                    <span className={`status ${(taskStatuses[name]?.status || 'not running').replace(' ', '-')}`}>
                      {taskStatuses[name]?.status || 'not running'}
                    </span>
                  </td>
                  <td>
                    <button 
                      onClick={() => executeTask(name)}
                      disabled={taskStatuses[name]?.status === 'running' || taskStatuses[name]?.status === 'waiting'}
                    >
                      Run
                    </button>
                    <button onClick={() => navigate(`/task/${name}`)}>
                      Archives
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
            </table>
          </div>
        </section>

        <section className="backends">
          <h2>Backends</h2>
          <div className="table-container">
            <table>
            <thead>
              <tr>
                <th>Name</th>
                <th>Type</th>
                <th>Details</th>
              </tr>
            </thead>
            <tbody>
              {Object.entries(backends).map(([name, backend]) => (
                <tr key={name}>
                  <td>{name}</td>
                  <td>{backend.type}</td>
                  <td>
                    {backend.type === 's3' ? (
                      <>Bucket: {backend.bucket}</>
                    ) : (
                      <>Path: {backend.path}</>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
            </table>
          </div>
        </section>
      </div>
    </div>
  );
}

function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<Dashboard />} />
        <Route path="/task/:taskName" element={<TaskDetails />} />
      </Routes>
    </BrowserRouter>
  );
}

export default App;
