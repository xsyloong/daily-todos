import "./Header.css";

interface HeaderProps {
  selectedDate: string;
  onToggleWidget: () => void;
  onToggleCalendar: () => void;
  onOpenSettings: () => void;
}

function Header({
  selectedDate,
  onToggleWidget,
  onToggleCalendar,
  onOpenSettings,
}: HeaderProps) {
  const formatDate = (dateStr: string) => {
    const date = new Date(dateStr + "T00:00:00");
    const year = date.getFullYear();
    const month = date.getMonth() + 1;
    const day = date.getDate();
    const weekdays = ["周日", "周一", "周二", "周三", "周四", "周五", "周六"];
    const weekday = weekdays[date.getDay()];
    return `${year}年${month}月${day}日 ${weekday}`;
  };

  return (
    <div className="header" data-tauri-drag-region>
      <div className="header-left" data-tauri-drag-region>
        <h1 className="header-title" data-tauri-drag-region>每日待办</h1>
        <button className="calendar-btn" onClick={onToggleCalendar}>
          📅 {formatDate(selectedDate)}
        </button>
      </div>
      <div className="header-right">
        <button
          className="header-icon-btn"
          onClick={onOpenSettings}
          title="设置"
        >
          ⚙
        </button>
        <button
          className="header-icon-btn"
          onClick={onToggleWidget}
          title="切换小组件模式"
        >
          ◩
        </button>
      </div>
    </div>
  );
}

export default Header;
