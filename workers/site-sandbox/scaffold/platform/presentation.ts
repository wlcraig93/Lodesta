const days = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"] as const;

export function orderedLocationHours(value: Record<string, string> | undefined) {
  return Object.entries(value ?? {}).map(([rawLabel, itemValue], sourceIndex) => {
    const firstDay = rawLabel.split("-", 1)[0] as (typeof days)[number];
    return { key: `${rawLabel}:${sourceIndex}`, label: rawLabel, value: itemValue, order: days.indexOf(firstDay), sourceIndex };
  }).sort((left, right) => left.order - right.order || left.sourceIndex - right.sourceIndex);
}

export function formatPhoneForDisplay(value: string) {
  const digits = value.replace(/\D/g, "");
  const national = digits.length === 11 && digits.startsWith("1") ? digits.slice(1) : digits;
  if (!/^[2-9]\d{2}[2-9]\d{6}$/.test(national)) return value;
  return `(${national.slice(0, 3)}) ${national.slice(3, 6)}-${national.slice(6)}`;
}
