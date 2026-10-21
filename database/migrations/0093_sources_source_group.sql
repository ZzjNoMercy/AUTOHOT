-- Accounts of one platform can count as one public source while staying separate participants.
ALTER TABLE sources ADD COLUMN source_group_id text;
