export default function WorkDesk({ children }) {
  return (
    <div className="space-y-4">
      <header>
        <h1 className="page-title">İş Takibi</h1>
      </header>
      {children}
    </div>
  );
}
