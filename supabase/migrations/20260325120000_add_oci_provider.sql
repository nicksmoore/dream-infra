-- Add Oracle Cloud Infrastructure as a supported cloud_provider enum value.
ALTER TYPE public.cloud_provider ADD VALUE IF NOT EXISTS 'oci';
