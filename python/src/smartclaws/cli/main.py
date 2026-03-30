import click


@click.group()
def cli() -> None:
    """SmartClaws CLI — IoT data protocol on SKALE."""


if __name__ == "__main__":
    cli()
