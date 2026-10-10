"""Run: python -m stemforge [--host 127.0.0.1] [--port 8000]"""
import argparse
import logging

import uvicorn

from .app import create_app


def main() -> None:
    p = argparse.ArgumentParser(prog="stemforge")
    p.add_argument("--host", default="127.0.0.1")
    p.add_argument("--port", type=int, default=8000)
    args = p.parse_args()
    logging.basicConfig(level=logging.INFO)
    uvicorn.run(create_app(), host=args.host, port=args.port)


if __name__ == "__main__":
    main()
