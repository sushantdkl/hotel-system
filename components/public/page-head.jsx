import PaintedEdge from '@/components/public/painted-edge';

/** Inner-page title on the white wall, closed by a thin painted red band. */
export default function PageHead({ title, lead, children }) {
  return (
    <header className="rc-page-head">
      <div className="rc-wrap">
        <h1 className="rc-h1">{title}</h1>
        {lead ? <p className="rc-lead">{lead}</p> : null}
        {children}
      </div>
      <div className="rc-dado"><PaintedEdge /></div>
    </header>
  );
}
