import React from 'react';
import { useParams, useNavigate } from 'react-router-dom';

const ArchiveDetails: React.FC = () => {
  const { taskName } = useParams();
  const navigate = useNavigate();

  return (
    <div className="container">
      <div className="header">
        <button onClick={() => navigate('/')} className="back-button">
          ← Back
        </button>
        <h1>{taskName}</h1>
      </div>
      
      <div className="content">
        <section>
          <h2>Archives</h2>
          <div className="archives-list">
            {/* Archive list will be populated here */}
          </div>
        </section>
      </div>
    </div>
  );
};

export default ArchiveDetails;
