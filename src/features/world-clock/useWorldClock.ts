import { useEffect, useState } from 'react';
import { KEY, workspaceStorage } from '@/features/workspace/workspace-storage';

export function useWorldClock() {
  const [now, setNow] = useState(new Date());
  const [zones, setZones] = useState<string[]>(() => {
    try {
      return (
        JSON.parse(workspaceStorage().getItem(KEY + "zones") || "null") || [
          "Asia/Dubai",
          "Europe/London",
          "America/New_York",
          "America/Los_Angeles",
        ]
      );
    } catch {
      return [
        "Asia/Dubai",
        "Europe/London",
        "America/New_York",
        "America/Los_Angeles",
      ];
    }
  });
  useEffect(() => {
    const timer = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(timer);
  }, []);
  return { now, zones, setZones };
}
