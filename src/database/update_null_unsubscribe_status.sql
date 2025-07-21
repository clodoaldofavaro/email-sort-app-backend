-- Update any NULL unsubscribe_status values to 'pending' for emails with unsubscribe links
UPDATE emails 
SET unsubscribe_status = 'pending' 
WHERE unsubscribe_link IS NOT NULL 
  AND unsubscribe_status IS NULL;

-- Also update the default constraint if needed to ensure new emails get 'pending' status
-- This is already done in the add_unsubscribe_columns.sql but including here for completeness
ALTER TABLE emails 
ALTER COLUMN unsubscribe_status 
SET DEFAULT 'pending';