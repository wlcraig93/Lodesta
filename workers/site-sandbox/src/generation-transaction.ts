export const generationPromotionBoundaries = [
  "before_next_pointer",
  "after_next_pointer",
  "after_pointer_rename",
  "after_active_readback",
  "after_operation_journal",
  "after_generation_cleanup"
] as const;

export type GenerationPromotionBoundary = typeof generationPromotionBoundaries[number];

export type GenerationPromotionAdapter<TActive, TJournal> = {
  removeNextPointer(): Promise<void>;
  createNextPointer(target: string): Promise<void>;
  replaceActivePointer(): Promise<void>;
  readActive(): Promise<TActive>;
  writeOperationJournal(journal: TJournal): Promise<void>;
  cleanupOldGenerations(): Promise<void>;
};

export async function promoteGenerationTransaction<TActive, TJournal>(input: {
  adapter: GenerationPromotionAdapter<TActive, TJournal>;
  target: string;
  journal: TJournal;
  validateActive(active: TActive): void;
  onPointerReplaced(): void;
  faultAtBoundary?: (boundary: GenerationPromotionBoundary) => void | Promise<void>;
}) {
  const boundary = async (value: GenerationPromotionBoundary) => {
    await input.faultAtBoundary?.(value);
  };

  await boundary("before_next_pointer");
  await input.adapter.removeNextPointer();
  await input.adapter.createNextPointer(input.target);
  await boundary("after_next_pointer");
  await input.adapter.replaceActivePointer();
  input.onPointerReplaced();
  await boundary("after_pointer_rename");

  const active = await input.adapter.readActive();
  input.validateActive(active);
  await boundary("after_active_readback");
  await input.adapter.writeOperationJournal(input.journal);
  await boundary("after_operation_journal");
  await input.adapter.cleanupOldGenerations();
  await boundary("after_generation_cleanup");
  return active;
}
