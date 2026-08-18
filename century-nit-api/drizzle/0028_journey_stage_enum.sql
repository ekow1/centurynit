-- Migrate existing application.stage display strings to the new JourneyStage enum values
UPDATE applications SET stage = 'document_verification' WHERE stage = 'Document Verification';
UPDATE applications SET stage = 'school_submission' WHERE stage = 'School Submission';
UPDATE applications SET stage = 'offer_letter_review' WHERE stage = 'Offer Letter Review';
UPDATE applications SET stage = 'visa_processing' WHERE stage = 'Visa Processing';
UPDATE applications SET stage = 'payment_execution' WHERE stage = 'Payment Plan';
UPDATE applications SET stage = 'travel_assistance' WHERE stage = 'Travel Assistance';
UPDATE applications SET stage = 'completed' WHERE stage = 'Completed';
-- Set any NULL or empty stages to the first stage
UPDATE applications SET stage = 'document_verification' WHERE stage IS NULL OR stage = '';
