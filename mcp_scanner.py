import json
import subprocess
import sys
from pathlib import Path

SERVER = Path(r"D:\repos\ccdd-gate\runners\complexity_mcp.py")
REPO = Path(r"D:\repos\sqlite-spreadsheet-sync")

def main():
    proc = subprocess.Popen([sys.executable, str(SERVER)], stdin=subprocess.PIPE, stdout=subprocess.PIPE, text=True, encoding="utf-8", bufsize=1)
    
    mid = 1
    def rpc(method, params=None):
        nonlocal mid
        req = {"jsonrpc": "2.0", "id": mid, "method": method}
        if params is not None: req["params"] = params
        mid += 1
        proc.stdin.write(json.dumps(req) + "\n")
        proc.stdin.flush()
        return json.loads(proc.stdout.readline())

    rpc("initialize", {"protocolVersion": "2024-11-05", "capabilities": {}})
    
    issues = []
    
    for ext in ["*.js", "*.jsx"]:
        for file in REPO.rglob(ext):
            if "node_modules" in str(file) or "dist" in str(file): continue
            try:
                code = file.read_text(encoding="utf-8")
            except:
                continue
            
            # measure complexity
            r = rpc("tools/call", {"name": "measure_complexity", "arguments": {"code": code, "filename": file.name}})
            if "error" in r: continue
            res = json.loads(r["result"]["content"][0]["text"])
            if "findings" in res:
                for f in res["findings"]:
                    if f.get("exceeds_threshold"):
                        issues.append(f"[{file.name}] Complexity issue in {f['function']}: {f['metric']} = {f['value']} (threshold {f['threshold']})")
            
            # scan guardrails
            r = rpc("tools/call", {"name": "scan_guardrails", "arguments": {"code": code, "filename": file.name}})
            res = json.loads(r["result"]["content"][0]["text"])
            for g in res.get("guardrails", []):
                if g["fired"]:
                    issues.append(f"[{file.name}] Guardrail fired: {g['id']} ({g['method']})")

    proc.stdin.close()
    proc.wait()
    
    with open("mcp_issues.json", "w") as f:
        json.dump(issues, f, indent=2)
    for i in issues:
        print(i)

if __name__ == "__main__":
    main()
