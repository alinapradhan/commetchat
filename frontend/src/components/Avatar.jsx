export default function Avatar({ name = "?", src, status, size = 40 }) {
  const initials = name
    .split(" ")
    .map((part) => part[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();

  return (
    <div className="avatar" style={{ width: size, height: size, fontSize: size * 0.38 }}>
      {src ? <img src={src} alt={name} /> : <span>{initials}</span>}
      {status === "online" && <i className="avatar-online" aria-label="online" />}
    </div>
  );
}
