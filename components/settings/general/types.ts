/** Editable shape of the add/edit secret modal form. The value is write-only:
 *  it is sent to the server on save and never rendered back. */
export type SecretFormState = {
  name: string;
  value: string;
};
