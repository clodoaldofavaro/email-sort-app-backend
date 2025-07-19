-- Add additional unsubscribe tracking columns to emails table

-- Add unsubscribe_status column
ALTER TABLE emails 
ADD COLUMN IF NOT EXISTS unsubscribe_status VARCHAR(20) 
DEFAULT 'pending' 
CHECK (unsubscribe_status IN ('pending', 'in_progress', 'completed', 'failed'));

-- Add unsubscribe_attempted_at column
ALTER TABLE emails 
ADD COLUMN IF NOT EXISTS unsubscribe_attempted_at TIMESTAMP;

-- Add unsubscribe_completed_at column
ALTER TABLE emails 
ADD COLUMN IF NOT EXISTS unsubscribe_completed_at TIMESTAMP;

-- Add unsubscribe_result column to store JSON result
ALTER TABLE emails 
ADD COLUMN IF NOT EXISTS unsubscribe_result JSONB;

-- Create an index on unsubscribe_status for better query performance
CREATE INDEX IF NOT EXISTS idx_emails_unsubscribe_status ON emails(unsubscribe_status);

-- Update existing records to set unsubscribe_status based on unsubscribed flag (if it exists)
DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM information_schema.columns 
               WHERE table_name = 'emails' AND column_name = 'unsubscribed') THEN
        UPDATE emails 
        SET unsubscribe_status = CASE 
            WHEN unsubscribed = true THEN 'completed'
            ELSE 'pending'
        END
        WHERE unsubscribe_status IS NULL;
    END IF;
END $$;

-- Migrate data from unsubscribed_at to unsubscribe_completed_at if the old column exists
DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM information_schema.columns 
               WHERE table_name = 'emails' AND column_name = 'unsubscribed_at') THEN
        UPDATE emails 
        SET unsubscribe_completed_at = unsubscribed_at 
        WHERE unsubscribed_at IS NOT NULL 
          AND unsubscribe_completed_at IS NULL;
    END IF;
END $$;