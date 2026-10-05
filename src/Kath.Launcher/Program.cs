using System.Diagnostics;

namespace Kath.Launcher;

internal static class Program
{
    [STAThread]
    private static int Main()
    {
        string bin = AppContext.BaseDirectory.TrimEnd(Path.DirectorySeparatorChar, Path.AltDirectorySeparatorChar);
        string executableRoot = Directory.GetParent(bin)?.FullName ?? bin;
        string? kathRoot = ResolveKathRoot(executableRoot);
        if (kathRoot is null)
        {
            ShowError($"Kath source/build directory could not be located from:\n{bin}\n\nRun the root Build.bat to rebuild Kath and Inu.");
            return 1;
        }

        string launcher = Path.Combine(kathRoot, "Run-Kath.bat");
        string versionFile = Path.Combine(kathRoot, "VERSION");
        string launcherVersion = typeof(Program).Assembly.GetName().Version?.ToString(3) ?? "unknown";
        string sourceVersion = File.Exists(versionFile) ? (File.ReadLines(versionFile).FirstOrDefault() ?? "").Trim() : "";
        if (!string.Equals(sourceVersion, launcherVersion, StringComparison.OrdinalIgnoreCase))
        {
            ShowError($"Kath launcher/source version mismatch.\n\nLauncher: {launcherVersion}\nSource: {(string.IsNullOrWhiteSpace(sourceVersion) ? "<missing>" : sourceVersion)}\n\nRun the root Build.bat to rebuild Kath.");
            return 1;
        }
        try
        {
            Process.Start(new ProcessStartInfo { FileName = launcher, WorkingDirectory = kathRoot, UseShellExecute = true });
            return 0;
        }
        catch (Exception ex) { ShowError(ex.Message); return 1; }
    }

    private static string? ResolveKathRoot(string executableRoot)
    {
        if (IsKathRoot(executableRoot)) return executableRoot; // <Kath&InuRoot>\Kath\Bin\Kath.exe
        string? productRoot = Directory.GetParent(executableRoot)?.FullName; // <Kath&InuRoot>\Inu\Bin\Kath.exe
        if (!string.IsNullOrWhiteSpace(productRoot))
        {
            string sibling = Path.Combine(productRoot, "Kath");
            if (IsKathRoot(sibling)) return sibling;
        }
        return null;
    }

    private static bool IsKathRoot(string path) =>
        File.Exists(Path.Combine(path, "VERSION")) && File.Exists(Path.Combine(path, "Run-Kath.bat"));

    private static void ShowError(string message) =>
        System.Windows.Forms.MessageBox.Show(message, "Kath", System.Windows.Forms.MessageBoxButtons.OK, System.Windows.Forms.MessageBoxIcon.Error);
}
