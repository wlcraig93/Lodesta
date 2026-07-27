-- Keep retained legacy operation names readable while making search, batched
-- reads, and exact hash-guarded edits available to new executions.
alter table external_authoring_operations
  drop constraint external_authoring_operations_tool_name_check;

alter table external_authoring_operations
  add constraint external_authoring_operations_tool_name_check
  check (tool_name in (
    'list_files',
    'search_files',
    'read_file',
    'read_files',
    'write_file',
    'delete_file',
    'apply_patch',
    'edit_file',
    'build_preview',
    'inspect_site',
    'request_input',
    'finish'
  ));
