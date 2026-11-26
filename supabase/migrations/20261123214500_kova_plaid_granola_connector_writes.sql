alter table public.connector_write_preferences
  drop constraint connector_write_preferences_connector_check,
  add constraint connector_write_preferences_connector_check
    check (connector in (
      'gmail', 'google-calendar', 'github', 'linear', 'onedrive', 'outlook',
      'google-drive', 'outlook-calendar', 'box', 'calendly', 'canva', 'custom-mcp', 'etoro', 'figma', 'gamma', 'granola',
      'google-bigquery', 'hubspot', 'hyperframes-heygen', 'meltwater', 'mixpanel', 'ms-teams', 'notion',
      'notion-private', 'plaid', 'salesforce', 'sharepoint', 'slack', 'stripe', 'tana', 'vercel', 'webull', 'wix'
    ));
