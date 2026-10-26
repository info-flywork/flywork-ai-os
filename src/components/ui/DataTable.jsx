

export default function DataTable({ children }) {
  return (
    <div className="panel-card overflow-x-auto">
      <table className="data-table">{children}</table>
    </div>
  );
}
