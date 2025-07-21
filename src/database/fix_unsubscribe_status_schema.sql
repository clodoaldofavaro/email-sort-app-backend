-- Remove the default 'pending' value from unsubscribe_status
ALTER TABLE emails 
ALTER COLUMN unsubscribe_status DROP DEFAULT;

-- Update existing records: 
-- Set to NULL if no unsubscribe link
-- Keep 'pending' only if there's an unsubscribe link
UPDATE emails 
SET unsubscribe_status = NULL 
WHERE unsubscribe_link IS NULL 
  AND unsubscribe_status = 'pending';

-- Ensure emails with unsubscribe links have at least 'pending' status
UPDATE emails 
SET unsubscribe_status = 'pending' 
WHERE unsubscribe_link IS NOT NULL 
  AND unsubscribe_status IS NULL;

-- Add a trigger to automatically set status to 'pending' when unsubscribe_link is added
CREATE OR REPLACE FUNCTION set_unsubscribe_status()
RETURNS TRIGGER AS $$
BEGIN
    -- If unsubscribe_link is being set and status is null, set it to pending
    IF NEW.unsubscribe_link IS NOT NULL AND OLD.unsubscribe_link IS NULL AND NEW.unsubscribe_status IS NULL THEN
        NEW.unsubscribe_status := 'pending';
    END IF;
    -- If unsubscribe_link is being removed, clear the status
    IF NEW.unsubscribe_link IS NULL AND OLD.unsubscribe_link IS NOT NULL THEN
        NEW.unsubscribe_status := NULL;
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Create trigger if it doesn't exist
DROP TRIGGER IF EXISTS set_unsubscribe_status_trigger ON emails;
CREATE TRIGGER set_unsubscribe_status_trigger
BEFORE UPDATE ON emails
FOR EACH ROW
EXECUTE FUNCTION set_unsubscribe_status();