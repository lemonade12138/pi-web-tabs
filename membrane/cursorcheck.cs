using System;
using System.Runtime.InteropServices;
using System.Threading;

public class CursorCheck
{
    [DllImport("user32.dll")] public static extern bool GetCursorInfo(out CURSORINFO pci);
    [DllImport("user32.dll")] public static extern IntPtr LoadCursor(IntPtr h, int id);
    [StructLayout(LayoutKind.Sequential)] public struct CURSORINFO { public int cbSize, flags; public IntPtr hCursor; public POINT pt; }
    [StructLayout(LayoutKind.Sequential)] public struct POINT { public int x, y; }

    public static void Main(string[] args)
    {
        int ms = args.Length > 0 ? int.Parse(args[0]) : 8000;
        IntPtr no = LoadCursor(IntPtr.Zero, 32648);     // IDC_NO 禁止
        IntPtr arrow = LoadCursor(IntPtr.Zero, 32512);  // IDC_ARROW
        IntPtr copy = LoadCursor(IntPtr.Zero, 32516);   // IDC_CROSS 近似（复制光标是定制的一般拿不到）
        IntPtr wait = LoadCursor(IntPtr.Zero, 32514);
        var sw = System.Diagnostics.Stopwatch.StartNew();
        while (sw.ElapsedMilliseconds < ms)
        {
            CURSORINFO ci = new CURSORINFO(); ci.cbSize = Marshal.SizeOf(typeof(CURSORINFO));
            if (GetCursorInfo(out ci) && (ci.flags & 1) != 0)
            {
                string name = ci.hCursor == no ? "BLOCKED(禁止)"
                    : ci.hCursor == arrow ? "ARROW(普通箭头)"
                    : ci.hCursor == wait ? "WAIT"
                    : "定制光标(" + ci.hCursor.ToString() + ")";
                Console.WriteLine(name + " @" + ci.pt.x + "," + ci.pt.y);
            }
            Thread.Sleep(500);
        }
    }
}
