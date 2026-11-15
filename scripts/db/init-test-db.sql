-- Runs once on first container boot (empty data volume): provision the
-- vitest database alongside the app/demo database.
CREATE DATABASE devflow_test;
