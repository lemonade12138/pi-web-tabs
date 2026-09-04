// 真实 OLE 文件拖拽：消息泵运转中按下 → OnMouseDown 里 DoDragDrop（标准模式）
// 用法: dragdrop.exe <被拖文件的完整路径> <目标hwnd十进制>
using System;
using System.Drawing;
using System.Runtime.InteropServices;
using System.Threading;
using System.Windows.Forms;

class DragTool
{
    [DllImport("user32.dll")] static extern bool SetCursorPos(int x, int y);
    [DllImport("user32.dll")] static extern void mouse_event(uint flags, uint dx, uint dy, uint data, UIntPtr extra);
    [DllImport("user32.dll")] static extern bool GetWindowRect(IntPtr hWnd, out RECT rect);
    [StructLayout(LayoutKind.Sequential)] public struct RECT { public int L, T, R, B; }
    const uint LEFTDOWN = 0x0002, LEFTUP = 0x0004;

    static IntPtr targetHwnd;
    static string filePath;
    public static bool textMode = false;
    public static string textPayload = "hello-drag-test";

    class SourceForm : Form
    {
        public string FilePath;
        public SourceForm()
        {
            StartPosition = FormStartPosition.Manual;
            Location = new Point(200, 800);
            Size = new Size(240, 120);
            Text = "DragSource";
        }
        protected override void OnMouseDown(MouseEventArgs e)
        {
            base.OnMouseDown(e);
            Console.WriteLine("dragstart");
            var data = new DataObject();
            if (DragTool.textMode) { data.SetData(DataFormats.UnicodeText, DragTool.textPayload); }
            else
            {
                var list = new System.Collections.Specialized.StringCollection();
                list.Add(FilePath);
                data.SetFileDropList(list);
            }
            var res = DoDragDrop(data, DragDropEffects.Copy);
            Console.WriteLine("effect:" + res);
            Application.Exit();
        }
    }

    static void Pump(int ms)
    {
        var sw = System.Diagnostics.Stopwatch.StartNew();
        while (sw.ElapsedMilliseconds < ms)
        {
            Application.DoEvents();
            Thread.Sleep(15);
        }
    }

    [STAThread]
    static void Main(string[] args)
    {
        filePath = args[0];
        targetHwnd = (IntPtr)long.Parse(args[1]);
        if (args.Length >= 3 && args[2] == "text") { textMode = true; }
        RECT r; GetWindowRect(targetHwnd, out r);
        int tx = (r.L + r.R) / 2, ty = (r.T + r.B) / 2;
        if (args.Length >= 4) { tx = r.L + int.Parse(args[2]); ty = r.T + int.Parse(args[3]); }
        Console.WriteLine("target center: " + tx + "," + ty);

        var form = new SourceForm { FilePath = filePath };
        form.Show();
        Application.DoEvents();

        SetCursorPos(300, 850); Pump(300);
        mouse_event(LEFTDOWN, 0, 0, 0, UIntPtr.Zero);
        Pump(400); // 分发 DOWN → OnMouseDown → DoDragDrop 阻塞进入拖拽循环
        for (int i = 1; i <= 25; i++)
        {
            SetCursorPos(300 + (tx - 300) * i / 25, 850 + (ty - 850) * i / 25);
            Pump(35);
        }
        Pump(800); // 悬停触发 DragEnter/Over
        mouse_event(LEFTUP, 0, 0, 0, UIntPtr.Zero);
        Pump(2000); // 等 DoDragDrop 返回
        Console.WriteLine("done");
    }
}
