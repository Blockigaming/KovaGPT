alter table public.connector_write_preferences
  drop constraint connector_write_preferences_connector_check,
  add constraint connector_write_preferences_connector_check
    check (connector in ('gmail', 'google-calendar', 'github', 'onedrive', 'outlook', 'google-drive', 'outlook-calendar', 'linear'));
