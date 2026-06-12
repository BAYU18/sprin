-- Add columns for driver harvesting metadata
ALTER TABLE printer_drivers
    ADD COLUMN source_client_id INTEGER REFERENCES clients(id) ON DELETE SET NULL,
    ADD COLUMN windows_driver_name VARCHAR(255),
    ADD COLUMN original_printer_name VARCHAR(255);

-- Add index for faster lookup by windows_driver_name
CREATE INDEX IF NOT EXISTS idx_printer_drivers_windows_driver_name ON printer_drivers (windows_driver_name);
