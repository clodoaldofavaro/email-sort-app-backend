-- Drop the unsubscribed_at and unsubscribed columns as they're replaced by unsubscribe_status and unsubscribe_completed_at

-- First, migrate any existing data from unsubscribed_at to unsubscribe_completed_at if needed
UPDATE emails 
SET unsubscribe_completed_at = unsubscribed_at 
WHERE unsubscribed_at IS NOT NULL 
  AND unsubscribe_completed_at IS NULL;

-- Update unsubscribe_status based on the old unsubscribed boolean flag
UPDATE emails 
SET unsubscribe_status = 'completed'
WHERE unsubscribed = true 
  AND unsubscribe_status != 'completed';

-- Also update the unsubscribe_status for any records that had unsubscribed_at set
UPDATE emails 
SET unsubscribe_status = 'completed'
WHERE unsubscribe_completed_at IS NOT NULL 
  AND unsubscribe_status != 'completed';

-- Drop the index on unsubscribed column before dropping the column
DROP INDEX IF EXISTS idx_emails_unsubscribed;

-- Now drop the redundant columns
ALTER TABLE emails 
DROP COLUMN IF EXISTS unsubscribed_at,
DROP COLUMN IF EXISTS unsubscribed;