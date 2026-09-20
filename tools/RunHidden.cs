// RunHidden.cs - source for runhidden.exe: start a console program with no window.
//
// Why this exists (measured)
//   A scheduled task whose action is node.exe gets a real console window under an
//   interactive logon. The task's own `-Hidden` setting does NOT help - that flag
//   hides the TASK in the Task Scheduler list, not the process window. Measured:
//   the UI server (pid 46100) had a conhost.exe child, which is the window the
//   user kept seeing. The 5-minute monitor would flash one every 5 minutes too.
//
//   Built with /target:winexe, this launcher has no console of its own, and it
//   starts the child with CREATE_NO_WINDOW, so neither process ever shows one.
//
// It WAITS for the child and returns its exit code, so Task Scheduler still shows
// the task as Running while a server runs, and still records a real failure code.
//
//   runhidden.exe <program> [args...]
//
// No cmd.exe involved.

using System;
using System.Diagnostics;
using System.IO;
using System.Text;
using System.Windows.Forms;

internal static class RunHidden
{
    private static int Main(string[] args)
    {
        if (args.Length < 1)
        {
            Fail("실행할 프로그램을 지정하지 않았습니다.\n\n사용법:\n  runhidden.exe <program> [args...]");
            return 2;
        }

        string program = args[0];
        if (!File.Exists(program))
        {
            Fail("실행할 프로그램을 찾을 수 없습니다.\n\n" + program);
            return 3;
        }

        var sb = new StringBuilder();
        for (int i = 1; i < args.Length; i++)
        {
            if (sb.Length > 0) sb.Append(' ');
            sb.Append(Quote(args[i]));
        }

        var psi = new ProcessStartInfo
        {
            FileName = program,
            Arguments = sb.ToString(),
            // The working directory is inherited from the task definition, which
            // is what the register scripts already set.
            WorkingDirectory = Directory.GetCurrentDirectory(),
            UseShellExecute = false,
            CreateNoWindow = true,
            WindowStyle = ProcessWindowStyle.Hidden,
        };

        try
        {
            using (Process p = Process.Start(psi))
            {
                p.WaitForExit();
                return p.ExitCode;
            }
        }
        catch (Exception ex)
        {
            Fail("실행에 실패했습니다.\n\n" + program + "\n\n" + ex.Message);
            return 1;
        }
    }

    // Standard Windows argument quoting: wrap when the value has whitespace or a
    // quote, and double up the backslashes that precede a quote.
    private static string Quote(string a)
    {
        if (a.Length > 0 && a.IndexOfAny(new[] { ' ', '\t', '"' }) < 0) return a;

        var sb = new StringBuilder("\"");
        int slashes = 0;
        foreach (char c in a)
        {
            if (c == '\\') { slashes++; continue; }
            if (c == '"') { sb.Append('\\', slashes * 2 + 1).Append('"'); }
            else { sb.Append('\\', slashes).Append(c); }
            slashes = 0;
        }
        sb.Append('\\', slashes * 2).Append('"');
        return sb.ToString();
    }

    // A windowless process has nowhere to print, so a failure must be a dialog.
    // Silence is the worst outcome: the task would fail and leave no trace a
    // person can see.
    private static void Fail(string message)
    {
        MessageBox.Show(message, "RetrySession", MessageBoxButtons.OK, MessageBoxIcon.Error);
    }
}
