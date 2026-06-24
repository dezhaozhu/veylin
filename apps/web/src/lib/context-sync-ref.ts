/** One-shot flag: next chat request should sync memory from truncated client messages. */
let branchEdit = false;

export function setBranchEdit(value: boolean): void {
  branchEdit = value;
}

export function consumeBranchEdit(): boolean {
  const value = branchEdit;
  branchEdit = false;
  return value;
}
