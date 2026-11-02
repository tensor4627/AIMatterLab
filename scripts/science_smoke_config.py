"""Standard-library-only input gate for an explicitly authorized scientific smoke."""
import argparse,json,os
from pathlib import Path

CONFIG_ENV="STUDIO_SCIENCE_SMOKE_CONFIG"

def load_config(filename):
    path=Path(filename).expanduser().resolve()
    checkout=Path(__file__).resolve().parents[1]
    if path.is_relative_to(checkout) and not path.is_relative_to(checkout/".studio"):
        raise ValueError("Keep the private smoke configuration under ignored .studio or outside the checkout")
    try:
        if path.stat().st_size>65536:raise ValueError("Scientific smoke configuration exceeds the bounded read limit")
        value=json.loads(path.read_text(encoding="utf-8-sig"))
    except (OSError,UnicodeError,json.JSONDecodeError):
        raise ValueError("Selected private scientific smoke configuration is unavailable or invalid") from None
    if not isinstance(value,dict) or type(value.get("schema_version")) is not int or value["schema_version"]!=1:raise ValueError("Scientific smoke configuration schema_version must be 1")
    def absolute(item):
        if not isinstance(item,str) or not item or any(c in item for c in "\0\r\n") or not Path(item).expanduser().is_absolute():
            raise ValueError("Explicit absolute runtime, interpreter, executable, repository and skill paths are required")
        return str(Path(item).expanduser())
    result={"schema_version":1,"base_dir":absolute(value.get("base_dir")),"python":absolute(value.get("python")),"sampling_repository":absolute(value.get("sampling_repository"))}
    for field,required in (("repositories",("pydyn","pygas","hotpp")),("executables",("gpumd","nep","gpu-sampling")),("skills",("nep-regression-rmse",))):
        group=value.get(field)
        if not isinstance(group,dict) or any(key not in group for key in required):raise ValueError("Explicit scientific smoke repositories, executables and skills are required")
        result[field]={key:absolute(group[key]) for key in required}
    base=Path(result["base_dir"])
    try:occupied=base.is_symlink() or base.exists() and (not base.is_dir() or any(base.iterdir()))
    except OSError:raise ValueError("Selected scientific smoke directory is unavailable") from None
    if occupied:raise ValueError("Choose a fresh isolated scientific smoke directory; existing history is preserved")
    return result

def parse_config_args(argv=None,environ=None):
    parser=argparse.ArgumentParser(description="Run the existing synthetic scientific smoke only with explicit private target configuration; no machine defaults.")
    parser.add_argument("--config",help="Private JSON configuration under ignored .studio or outside the checkout; alternatively set "+CONFIG_ENV)
    args=parser.parse_args(argv)
    filename=args.config or (os.environ if environ is None else environ).get(CONFIG_ENV)
    if not filename:parser.error("Explicit --config or "+CONFIG_ENV+" is required; no scientific modules or runtime directories were initialized")
    try:return load_config(filename)
    except ValueError as error:parser.error(str(error))
