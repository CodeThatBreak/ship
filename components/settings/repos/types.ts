/** Editable shape of the add/edit repo modal form. */
export type RepoFormState = {
  name: string;
  cloud_url: string;
  local_path: string;
  default_branch: string;
  install_command: string;
  skip_install: boolean;
  sync_paths: string;
  shared_dirs: string;
  setup_command: string;
};
