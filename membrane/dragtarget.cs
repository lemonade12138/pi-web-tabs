using System;
using System.Windows.Forms;
class DropSink : Form
{
    [STAThread]
    static void Main()
    {
        var f = new DropSink();
        f.Text = "DropSink"; f.Size = new System.Drawing.Size(400, 300);
        f.AllowDrop = true;
        f.DragEnter += (s, e) => { Console.WriteLine("ENTER:" + e.Effect); };
        f.DragOver += (s, e) => { Console.WriteLine("OVER"); };
        f.DragDrop += (s, e) => {
            var files = (string[])e.Data.GetData(DataFormats.FileDrop);
            Console.WriteLine("DROP:" + (files == null ? "null" : string.Join(";", files)));
        };
        f.Show();
        Console.WriteLine("hwnd:" + f.Handle);
        Application.Run(f);
    }
}
