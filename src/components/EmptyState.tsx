export default function EmptyState() {
  return (
    <div className="empty">
      <pre>
        <span className="empty-ascii">{`  ██╗    ██╗███████╗
  ██║    ██║██╔════╝
  ██║ █╗ ██║█████╗
  ██║███╗██║██╔══╝
  ╚███╔███╔╝███████╗
   ╚══╝╚══╝ ╚══════╝`}</span>
        {'\n\n'}
        <span className="empty-head">{'# nothing open'}</span>
        {'\n\n'}
        <span className="empty-key">{'ctrl+p'}</span>
        {'          open a file\n'}
        <span className="empty-key">{'ctrl+shift+p'}</span>
        {'    run a command\n'}
        <span className="empty-key">{'ctrl+o'}</span>
        {'          open a folder\n\n'}
        {'- - - - - - - - - - - - - - - - - -\n\n'}
        {'we 0.1.0 · local editor · pierre theme\n'}
      </pre>
    </div>
  );
}
