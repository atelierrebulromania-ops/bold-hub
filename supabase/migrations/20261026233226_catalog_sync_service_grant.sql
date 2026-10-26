-- The scheduled catalog sync runs with the server key: let it call the internal sync function.
grant execute on function private.sync_bocp_catalog(jsonb) to service_role;
