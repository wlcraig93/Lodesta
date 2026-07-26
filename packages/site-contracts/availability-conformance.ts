export const continuousAvailabilityConformanceVectors = [
  { value: "Open 24 hours", continuous: true },
  { value: "24 hours", continuous: true },
  { value: "Open 24 hours daily", continuous: true },
  { value: "24 hours a day", continuous: true },
  { value: "24/7", continuous: true },
  { value: "Not open 24 hours", continuous: false },
  { value: "Isn't open 24 hours", continuous: false },
  { value: "24-hour emergency service", continuous: false },
  { value: "Emergency line open 24 hours", continuous: false },
  { value: "24-hour emergency line only", continuous: false },
  { value: "24/7 phone support", continuous: false },
  { value: "Open 24 hours except holidays", continuous: false },
  { value: "Open by appointment 24 hours", continuous: false },
  { value: "8:00 AM-5:00 PM", continuous: false },
  { value: "Closed", continuous: false }
] as const;
