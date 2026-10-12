export const cities = [
  ["北京", "Asia/Shanghai"],
  ["纽约", "America/New_York"],
  ["伦敦", "Europe/London"],
  ["迪拜", "Asia/Dubai"],
  ["东京", "Asia/Tokyo"],
  ["巴黎", "Europe/Paris"],
  ["悉尼", "Australia/Sydney"],
  ["洛杉矶", "America/Los_Angeles"],
  ["新加坡", "Asia/Singapore"],
] as const;
export function clock(date: Date, zone: string) {
  const time = new Intl.DateTimeFormat("en-GB", {
    timeZone: zone,
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  }).format(date);
  return {
    time,
    date: new Intl.DateTimeFormat("zh-CN", {
      timeZone: zone,
      month: "2-digit",
      day: "2-digit",
      weekday: "short",
    }).format(date),
    office:
      Number(time.slice(0, 2)) >= 9 &&
      Number(time.slice(0, 2)) < 18 &&
      !["Sat", "Sun"].includes(
        new Intl.DateTimeFormat("en-US", {
          timeZone: zone,
          weekday: "short",
        }).format(date),
      ),
  };
}
