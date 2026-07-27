import time


def main() -> None:
    """Placeholder worker loop for local composition."""
    while True:
        print("worker heartbeat", flush=True)
        time.sleep(30)
