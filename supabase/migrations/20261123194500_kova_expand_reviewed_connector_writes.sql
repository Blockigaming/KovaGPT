alter table public.connector_write_preferences
  drop constraint connector_write_preferences_connector_check,
  add constraint connector_write_preferences_connector_check
    check (connector in (
      'gmail', 'google-calendar', 'github', 'linear', 'onedrive', 'outlook',
      'google-drive', 'outlook-calendar', 'box', 'calendly', 'canva', 'figma',
      'google-bigquery', 'hubspot', 'meltwater', 'ms-teams', 'notion', 'notion-private',
      'salesforce', 'sharepoint', 'slack', 'vercel'
    ));
