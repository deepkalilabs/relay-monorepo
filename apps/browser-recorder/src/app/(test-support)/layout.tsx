export default function TestSupportLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return <div className="unscaled-app-ui">{children}</div>;
}
