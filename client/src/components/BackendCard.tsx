import React from 'react';
import { Backend } from '../types';

interface BackendCardProps {
  name: string;
  backend: Backend;
}

const BackendCard: React.FC<BackendCardProps> = ({ name, backend }) => {
  const formatValue = (key: string, value: any): string => {
    if (key === 'accessKeyId' || key === 'secretAccessKey') {
      return '[Set]';
    }
    if (typeof value === 'boolean') {
      return value ? 'Yes' : 'No';
    }
    return value;
  };

  const renderInfoRow = (label: string, value: any) => (
    <div className="info-row">
      <span className="info-label">{label}:</span>
      <span className="info-value">{formatValue(label.toLowerCase(), value)}</span>
    </div>
  );

  const getBackendIcon = () => {
    switch (backend.type) {
      case 's3':
        return '☁️';
      case 'local':
        return '📁';
    }
  };

  return (
    <div className="backend-card">
      <div className="backend-header">
        <span className="backend-icon">{getBackendIcon()}</span>
        <div className="backend-title">
          <h3>{name}</h3>
          <span className="backend-type">{backend.type.toUpperCase()} Storage</span>
        </div>
      </div>
      
      <div className="backend-details">
        {backend.type === 's3' && (
          <>
            {renderInfoRow('Bucket', backend.bucket)}
            {renderInfoRow('Region', backend.region)}
            {backend.endpoint && renderInfoRow('Endpoint', backend.endpoint)}
            {backend.prefix && renderInfoRow('Prefix', backend.prefix)}
            {renderInfoRow('Path Style', backend.forcePathStyle)}
            {renderInfoRow('SSL Enabled', backend.sslEnabled)}
            {renderInfoRow('Access Key', '[Set]')}
          </>
        )}
        {backend.type === 'local' && (
          <>
            {renderInfoRow('Path', backend.path)}
          </>
        )}
      </div>
    </div>
  );
};

export default BackendCard;
