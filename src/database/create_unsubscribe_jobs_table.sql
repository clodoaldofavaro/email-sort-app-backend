-- Create table for tracking async unsubscribe batch jobs
CREATE TABLE IF NOT EXISTS unsubscribe_jobs (
    id UUID PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    total_emails INTEGER NOT NULL DEFAULT 0,
    processed_count INTEGER NOT NULL DEFAULT 0,
    success_count INTEGER NOT NULL DEFAULT 0,
    failed_count INTEGER NOT NULL DEFAULT 0,
    status VARCHAR(50) NOT NULL DEFAULT 'pending', -- pending, processing, completed, failed
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
    completed_at TIMESTAMP WITH TIME ZONE,
    error_message TEXT
);

-- Create indexes for efficient querying
CREATE INDEX idx_unsubscribe_jobs_user_id ON unsubscribe_jobs(user_id);
CREATE INDEX idx_unsubscribe_jobs_status ON unsubscribe_jobs(status);
CREATE INDEX idx_unsubscribe_jobs_created_at ON unsubscribe_jobs(created_at);

-- Table for tracking individual email results within a batch job
CREATE TABLE IF NOT EXISTS unsubscribe_job_results (
    id SERIAL PRIMARY KEY,
    job_id UUID NOT NULL REFERENCES unsubscribe_jobs(id) ON DELETE CASCADE,
    email_id INTEGER NOT NULL REFERENCES emails(id) ON DELETE CASCADE,
    success BOOLEAN NOT NULL DEFAULT FALSE,
    message TEXT,
    processed_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- Create indexes for job results
CREATE INDEX idx_unsubscribe_job_results_job_id ON unsubscribe_job_results(job_id);
CREATE INDEX idx_unsubscribe_job_results_email_id ON unsubscribe_job_results(email_id);