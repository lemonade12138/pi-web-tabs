using System;
using System.Runtime.InteropServices;

public class ILCheck
{
    [DllImport("advapi32.dll", SetLastError = true)] public static extern bool OpenProcessToken(IntPtr p, uint a, out IntPtr t);
    [DllImport("advapi32.dll", SetLastError = true)] public static extern bool GetTokenInformation(IntPtr t, int c, IntPtr i, uint l, out uint r);
    [DllImport("advapi32.dll")] public static extern IntPtr GetSidSubAuthority(IntPtr s, int i);
    [DllImport("advapi32.dll")] public static extern IntPtr GetSidSubAuthorityCount(IntPtr s);
    [DllImport("kernel32.dll")] public static extern IntPtr OpenProcess(uint a, bool h, int p);
    [DllImport("kernel32.dll")] public static extern bool CloseHandle(IntPtr h);

    public static string IL(int pid)
    {
        IntPtr h = OpenProcess(0x1000, false, pid);
        if (h == IntPtr.Zero) return "no-access";
        IntPtr t; OpenProcessToken(h, 8, out t);
        uint rl; GetTokenInformation(t, 25, IntPtr.Zero, 0, out rl);
        IntPtr buf = Marshal.AllocHGlobal((int)rl);
        GetTokenInformation(t, 25, buf, rl, out rl);
        IntPtr sidp = Marshal.ReadIntPtr(buf);
        int n = Marshal.ReadByte(GetSidSubAuthorityCount(sidp)) - 1;
        int v = Marshal.ReadInt32(GetSidSubAuthority(sidp, n));
        Marshal.FreeHGlobal(buf); CloseHandle(t); CloseHandle(h);
        return string.Format("0x{0:x}", v);
    }

    public static void Main(string[] args)
    {
        Console.WriteLine("explorer=" + IL(int.Parse(args[0])));
        Console.WriteLine("piweb=" + IL(int.Parse(args[1])));
        Console.WriteLine("self=" + IL(System.Diagnostics.Process.GetCurrentProcess().Id));
    }
}
