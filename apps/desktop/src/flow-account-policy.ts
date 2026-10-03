import { MAX_FLOW_ACCOUNTS } from "@gold-work/shared";

/** Existing accounts remain editable at capacity; only creating a sixth profile is rejected. */
export function assertFlowAccountCapacity(existingIds: readonly string[], requestedId: string): void {
  if (existingIds.includes(requestedId)) return;
  if (existingIds.length < MAX_FLOW_ACCOUNTS) return;
  throw new Error(
    `Можно подключить не более ${MAX_FLOW_ACCOUNTS} Flow-аккаунтов. `
    + "Удалите ненужный аккаунт перед добавлением нового."
  );
}
